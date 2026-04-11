package push

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

const renderBaseURL = "https://api.render.com/v1"

// RenderPlatform implements Platform for Render.com push sync.
type RenderPlatform struct{}

// renderEnvVar represents a single env var in the Render API.
type renderEnvVar struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func NewRenderPlatform() *RenderPlatform {
	return &RenderPlatform{}
}

func (r *RenderPlatform) Name() string {
	return "render"
}

func (r *RenderPlatform) Validate(config map[string]string) error {
	if config["api_key"] == "" {
		return fmt.Errorf("render: missing required config key: api_key")
	}
	if config["service_id"] == "" {
		return fmt.Errorf("render: missing required config key: service_id")
	}
	return nil
}

func (r *RenderPlatform) Push(ctx context.Context, target *Target, envVars map[string]string) error {
	apiKey := target.Config["api_key"]
	serviceID := target.Config["service_id"]

	// 1. GET current env vars
	current, err := r.getEnvVars(ctx, apiKey, serviceID)
	if err != nil {
		return fmt.Errorf("render: failed to get current env vars: %w", err)
	}

	// 2. Merge: start from current, overlay new values
	merged := make(map[string]string, len(current)+len(envVars))
	for _, ev := range current {
		merged[ev.Key] = ev.Value
	}
	for k, v := range envVars {
		merged[k] = v
	}

	// 3. Convert merged map back to slice
	payload := make([]renderEnvVar, 0, len(merged))
	for k, v := range merged {
		payload = append(payload, renderEnvVar{Key: k, Value: v})
	}

	// 4. PUT the full merged list
	if err := r.putEnvVars(ctx, apiKey, serviceID, payload); err != nil {
		return fmt.Errorf("render: failed to update env vars: %w", err)
	}

	return nil
}

func (r *RenderPlatform) getEnvVars(ctx context.Context, apiKey, serviceID string) ([]renderEnvVar, error) {
	url := fmt.Sprintf("%s/services/%s/env-vars", renderBaseURL, serviceID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GET env-vars returned %d: %s", resp.StatusCode, string(body))
	}

	var vars []renderEnvVar
	if err := json.NewDecoder(resp.Body).Decode(&vars); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return vars, nil
}

func (r *RenderPlatform) putEnvVars(ctx context.Context, apiKey, serviceID string, vars []renderEnvVar) error {
	url := fmt.Sprintf("%s/services/%s/env-vars", renderBaseURL, serviceID)

	body, err := json.Marshal(vars)
	if err != nil {
		return fmt.Errorf("failed to marshal env vars: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("PUT env-vars returned %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}
