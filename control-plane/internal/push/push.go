package push

import (
	"context"
	"fmt"
)

// Platform defines the interface for push-syncing env vars to hosting platforms.
// SF-4: Push accepts a map of env vars to support proxy mode (key + base URL).
type Platform interface {
	Name() string
	Push(ctx context.Context, target *Target, envVars map[string]string) error
	Validate(config map[string]string) error
}

type Target struct {
	ID       string
	Platform string
	Config   map[string]string
	EnvVar   string
	Mode     string // "fetch" or "proxy"
}

// Registry holds all registered push sync platforms.
type Registry struct {
	platforms map[string]Platform
}

func NewRegistry() *Registry {
	return &Registry{platforms: make(map[string]Platform)}
}

func (r *Registry) Register(p Platform) {
	r.platforms[p.Name()] = p
}

func (r *Registry) Get(name string) (Platform, error) {
	p, ok := r.platforms[name]
	if !ok {
		return nil, fmt.Errorf("unknown platform: %s", name)
	}
	return p, nil
}

func (r *Registry) List() []string {
	names := make([]string, 0, len(r.platforms))
	for name := range r.platforms {
		names = append(names, name)
	}
	return names
}
