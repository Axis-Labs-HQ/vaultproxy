package config

import (
	"os"

	"github.com/joho/godotenv"
	"github.com/rs/zerolog/log"
)

type Config struct {
	Port               string
	DatabaseURL        string
	EncryptionMasterKey string
	JWTSecret          string
	InternalAPIKey     string
	AllowedOrigins     string
	Environment        string
}

func Load() *Config {
	_ = godotenv.Load()

	encKey := getEnv("ENCRYPTION_MASTER_KEY", "")
	jwtSecret := getEnv("JWT_SECRET", "")

	// In production, these MUST be separate secrets. A shared secret means
	// compromising JWT signing also compromises all encrypted API keys.
	if encKey != "" && jwtSecret != "" && encKey == jwtSecret {
		log.Fatal().Msg("ENCRYPTION_MASTER_KEY and JWT_SECRET must be different values")
	}

	// Fall back to each other only in development for convenience.
	if encKey == "" {
		encKey = jwtSecret
	}
	if jwtSecret == "" {
		jwtSecret = encKey
	}

	return &Config{
		Port:               getEnv("PORT", "8080"),
		DatabaseURL:        getEnv("DATABASE_URL", "vaultproxy.db"),
		EncryptionMasterKey: encKey,
		JWTSecret:          jwtSecret,
		InternalAPIKey:     getEnv("INTERNAL_API_KEY", ""),
		AllowedOrigins:     getEnv("ALLOWED_ORIGINS", "https://app.vaultproxy.dev"),
		Environment:        getEnv("ENVIRONMENT", "development"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvFallback(primary, secondary, fallback string) string {
	if v := os.Getenv(primary); v != "" {
		return v
	}
	if v := os.Getenv(secondary); v != "" {
		return v
	}
	return fallback
}
