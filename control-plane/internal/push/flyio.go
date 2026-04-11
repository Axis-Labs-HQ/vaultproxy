package push

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

const flyGraphQLEndpoint = "https://api.fly.io/graphql"

var requiredFlyConfigKeys = []string{
	"access_token",
	"app_id",
}

// FlyIO implements the Platform interface for Fly.io deployments.
// Setting secrets via the Fly.io GraphQL API triggers an automatic redeploy.
type FlyIO struct{}

func NewFlyIO() *FlyIO {
	return &FlyIO{}
}

func (f *FlyIO) Name() string {
	return "flyio"
}

// Validate checks that all required Fly.io config keys are present and non-empty.
func (f *FlyIO) Validate(config map[string]string) error {
	for _, key := range requiredFlyConfigKeys {
		if config[key] == "" {
			return fmt.Errorf("flyio: missing required config key %q", key)
		}
	}
	return nil
}

// Push sets all env vars as secrets on the Fly.io app via the GraphQL API.
// This is done in a single mutation call, which triggers one redeploy.
func (f *FlyIO) Push(ctx context.Context, target *Target, envVars map[string]string) error {
	if err := f.Validate(target.Config); err != nil {
		return err
	}

	accessToken := target.Config["access_token"]
	appID := target.Config["app_id"]

	secrets := make([]map[string]string, 0, len(envVars))
	for key, value := range envVars {
		secrets = append(secrets, map[string]string{
			"key":   key,
			"value": value,
		})
	}

	query := `mutation($appId: String!, $secrets: [SecretInput!]!) {
  setSecrets(input: { appId: $appId, secrets: $secrets }) {
    app { name }
  }
}`

	reqBody := graphqlRequest{
		Query: query,
		Variables: map[string]any{
			"appId":   appID,
			"secrets": secrets,
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("flyio: failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, flyGraphQLEndpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("flyio: failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("flyio: request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("flyio: failed to read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("flyio: unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	var gqlResp graphqlResponse
	if err := json.Unmarshal(respBody, &gqlResp); err != nil {
		return fmt.Errorf("flyio: failed to decode response: %w", err)
	}

	if len(gqlResp.Errors) > 0 {
		return fmt.Errorf("flyio: graphql error: %s", gqlResp.Errors[0].Message)
	}

	return nil
}
