package push

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

const railwayGraphQLEndpoint = "https://backboard.railway.com/graphql/v2"

var requiredRailwayConfigKeys = []string{
	"api_token",
	"project_id",
	"service_id",
	"environment_id",
}

// Railway implements the Platform interface for Railway deployments.
type Railway struct{}

func NewRailway() *Railway {
	return &Railway{}
}

func (r *Railway) Name() string {
	return "railway"
}

// Validate checks that all required Railway config keys are present and non-empty.
func (r *Railway) Validate(config map[string]string) error {
	for _, key := range requiredRailwayConfigKeys {
		if config[key] == "" {
			return fmt.Errorf("railway: missing required config key %q", key)
		}
	}
	return nil
}

// Push upserts each env var into the Railway project via the GraphQL API.
func (r *Railway) Push(ctx context.Context, target *Target, envVars map[string]string) error {
	if err := r.Validate(target.Config); err != nil {
		return err
	}

	apiToken := target.Config["api_token"]
	projectID := target.Config["project_id"]
	serviceID := target.Config["service_id"]
	environmentID := target.Config["environment_id"]

	for name, value := range envVars {
		if err := r.upsertVariable(ctx, apiToken, projectID, serviceID, environmentID, name, value); err != nil {
			return fmt.Errorf("railway: failed to upsert variable %q: %w", name, err)
		}
	}

	return nil
}

// graphqlRequest is the JSON body sent to Railway's GraphQL API.
type graphqlRequest struct {
	Query     string         `json:"query"`
	Variables map[string]any `json:"variables"`
}

// graphqlResponse represents the top-level JSON response from Railway's GraphQL API.
type graphqlResponse struct {
	Data   json.RawMessage `json:"data"`
	Errors []graphqlError  `json:"errors"`
}

type graphqlError struct {
	Message string `json:"message"`
}

func (r *Railway) upsertVariable(ctx context.Context, apiToken, projectID, serviceID, environmentID, name, value string) error {
	query := `mutation($input: VariableUpsertInput!) {
  variableUpsert(input: $input)
}`

	reqBody := graphqlRequest{
		Query: query,
		Variables: map[string]any{
			"input": map[string]any{
				"projectId":     projectID,
				"environmentId": environmentID,
				"serviceId":     serviceID,
				"name":          name,
				"value":         value,
			},
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, railwayGraphQLEndpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
	}

	var gqlResp graphqlResponse
	if err := json.Unmarshal(respBody, &gqlResp); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}

	if len(gqlResp.Errors) > 0 {
		return fmt.Errorf("graphql error: %s", gqlResp.Errors[0].Message)
	}

	return nil
}
