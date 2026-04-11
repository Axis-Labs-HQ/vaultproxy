package push

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

const vercelBaseURL = "https://api.vercel.com/v10"

// Vercel implements Platform for pushing env vars to Vercel projects.
type Vercel struct{}

// vercelEnvVar represents a single env var returned by the Vercel API.
type vercelEnvVar struct {
	ID     string   `json:"id"`
	Key    string   `json:"key"`
	Value  string   `json:"value"`
	Type   string   `json:"type"`
	Target []string `json:"target"`
}

// vercelEnvListResponse represents the response from GET /env.
type vercelEnvListResponse struct {
	Envs []vercelEnvVar `json:"envs"`
}

// vercelEnvCreateRequest represents the body for creating an env var.
type vercelEnvCreateRequest struct {
	Key    string   `json:"key"`
	Value  string   `json:"value"`
	Type   string   `json:"type"`
	Target []string `json:"target"`
}

func NewVercel() *Vercel {
	return &Vercel{}
}

func (v *Vercel) Name() string {
	return "vercel"
}

func (v *Vercel) Validate(config map[string]string) error {
	if config["access_token"] == "" {
		return fmt.Errorf("vercel: missing required config key: access_token")
	}
	if config["project_id"] == "" {
		return fmt.Errorf("vercel: missing required config key: project_id")
	}
	return nil
}

func (v *Vercel) Push(ctx context.Context, target *Target, envVars map[string]string) error {
	if err := v.Validate(target.Config); err != nil {
		return err
	}

	token := target.Config["access_token"]
	projectID := target.Config["project_id"]
	teamID := target.Config["team_id"]

	// Fetch existing env vars once.
	existing, err := v.listEnvVars(ctx, token, projectID, teamID)
	if err != nil {
		return fmt.Errorf("vercel: failed to list env vars: %w", err)
	}

	// Build a lookup by key.
	existingByKey := make(map[string]vercelEnvVar, len(existing))
	for _, e := range existing {
		existingByKey[e.Key] = e
	}

	for key, value := range envVars {
		if ev, ok := existingByKey[key]; ok {
			if err := v.updateEnvVar(ctx, token, projectID, teamID, ev.ID, value); err != nil {
				return fmt.Errorf("vercel: failed to update env var %s: %w", key, err)
			}
		} else {
			if err := v.createEnvVar(ctx, token, projectID, teamID, key, value); err != nil {
				return fmt.Errorf("vercel: failed to create env var %s: %w", key, err)
			}
		}
	}

	return nil
}

func (v *Vercel) listEnvVars(ctx context.Context, token, projectID, teamID string) ([]vercelEnvVar, error) {
	u := fmt.Sprintf("%s/projects/%s/env", vercelBaseURL, url.PathEscape(projectID))
	u = appendTeamID(u, teamID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var listResp vercelEnvListResponse
	if err := json.NewDecoder(resp.Body).Decode(&listResp); err != nil {
		return nil, err
	}
	return listResp.Envs, nil
}

func (v *Vercel) createEnvVar(ctx context.Context, token, projectID, teamID, key, value string) error {
	u := fmt.Sprintf("%s/projects/%s/env", vercelBaseURL, url.PathEscape(projectID))
	u = appendTeamID(u, teamID)

	body := vercelEnvCreateRequest{
		Key:    key,
		Value:  value,
		Type:   "encrypted",
		Target: []string{"production"},
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

func (v *Vercel) updateEnvVar(ctx context.Context, token, projectID, teamID, envID, value string) error {
	u := fmt.Sprintf("%s/projects/%s/env/%s", vercelBaseURL, url.PathEscape(projectID), url.PathEscape(envID))
	u = appendTeamID(u, teamID)

	body := vercelEnvCreateRequest{
		Value:  value,
		Type:   "encrypted",
		Target: []string{"production"},
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, u, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// appendTeamID adds the teamId query parameter if teamID is non-empty.
func appendTeamID(rawURL, teamID string) string {
	if teamID == "" {
		return rawURL
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	q := parsed.Query()
	q.Set("teamId", teamID)
	parsed.RawQuery = q.Encode()
	return parsed.String()
}
