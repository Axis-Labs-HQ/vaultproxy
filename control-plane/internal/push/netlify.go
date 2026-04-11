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

const netlifyAPIBase = "https://api.netlify.com/api/v1"

var requiredNetlifyConfigKeys = []string{
	"access_token",
	"account_id",
	"site_id",
}

// Netlify implements the Platform interface for Netlify deployments.
type Netlify struct{}

func NewNetlify() *Netlify {
	return &Netlify{}
}

func (n *Netlify) Name() string {
	return "netlify"
}

// Validate checks that all required Netlify config keys are present and non-empty.
func (n *Netlify) Validate(config map[string]string) error {
	for _, key := range requiredNetlifyConfigKeys {
		if config[key] == "" {
			return fmt.Errorf("netlify: missing required config key %q", key)
		}
	}
	return nil
}

// Push upserts each env var into the Netlify site via the REST API.
// For each variable it tries PATCH (update) first; if the variable does not
// exist (404), it falls back to POST (create). All values use the
// "production" context.
func (n *Netlify) Push(ctx context.Context, target *Target, envVars map[string]string) error {
	if err := n.Validate(target.Config); err != nil {
		return err
	}

	accessToken := target.Config["access_token"]
	accountID := target.Config["account_id"]
	siteID := target.Config["site_id"]

	for name, value := range envVars {
		if err := n.upsertEnvVar(ctx, accessToken, accountID, siteID, name, value); err != nil {
			return fmt.Errorf("netlify: failed to upsert variable %q: %w", name, err)
		}
	}

	return nil
}

// netlifyEnvValue is a single context/value pair sent in the Netlify env API.
type netlifyEnvValue struct {
	Value   string `json:"value"`
	Context string `json:"context"`
}

// netlifyEnvEntry is used when creating a new env var via POST.
type netlifyEnvEntry struct {
	Key    string            `json:"key"`
	Values []netlifyEnvValue `json:"values"`
}

// netlifyPatchBody is used when updating an existing env var via PATCH.
type netlifyPatchBody struct {
	Value   string `json:"value"`
	Context string `json:"context"`
}

func (n *Netlify) upsertEnvVar(ctx context.Context, accessToken, accountID, siteID, name, value string) error {
	// Try PATCH first (update existing variable).
	updated, err := n.updateEnvVar(ctx, accessToken, accountID, name, value)
	if err != nil {
		return err
	}
	if updated {
		return nil
	}

	// Variable does not exist — create it with POST.
	return n.createEnvVar(ctx, accessToken, accountID, siteID, name, value)
}

// updateEnvVar sends a PATCH request to update an existing env var.
// Returns (true, nil) on success, (false, nil) if the variable was not found,
// or (false, err) on unexpected failures.
func (n *Netlify) updateEnvVar(ctx context.Context, accessToken, accountID, key, value string) (bool, error) {
	endpoint := fmt.Sprintf("%s/accounts/%s/env/%s",
		netlifyAPIBase, accountID, url.PathEscape(key))

	body, err := json.Marshal(netlifyPatchBody{
		Value:   value,
		Context: "production",
	})
	if err != nil {
		return false, fmt.Errorf("failed to marshal patch body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, endpoint, bytes.NewReader(body))
	if err != nil {
		return false, fmt.Errorf("failed to create patch request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("patch request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, fmt.Errorf("failed to read patch response body: %w", err)
	}

	if resp.StatusCode == http.StatusNotFound {
		return false, nil
	}

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("unexpected patch status %d: %s", resp.StatusCode, string(respBody))
	}

	return true, nil
}

// createEnvVar sends a POST request to create a new env var.
func (n *Netlify) createEnvVar(ctx context.Context, accessToken, accountID, siteID, key, value string) error {
	endpoint := fmt.Sprintf("%s/accounts/%s/env?site_id=%s",
		netlifyAPIBase, accountID, url.QueryEscape(siteID))

	entries := []netlifyEnvEntry{
		{
			Key: key,
			Values: []netlifyEnvValue{
				{Value: value, Context: "production"},
			},
		},
	}

	body, err := json.Marshal(entries)
	if err != nil {
		return fmt.Errorf("failed to marshal post body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create post request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("post request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read post response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("unexpected post status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}
