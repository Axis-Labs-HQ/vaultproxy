package keys

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"time"

	"golang.org/x/crypto/hkdf"
)

type Service struct {
	db  *sql.DB
	gcm cipher.AEAD
}

type APIKey struct {
	ID          string    `json:"id"`
	OrgID       string    `json:"org_id"`
	Name        string    `json:"name"`
	Provider    string    `json:"provider"`
	KeyPrefix   string    `json:"key_prefix"`
	Alias       string    `json:"alias"`
	IsActive    bool      `json:"is_active"`
	LastRotated *string   `json:"last_rotated_at,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

func NewService(db *sql.DB, masterKey string) (*Service, error) {
	hkdfReader := hkdf.New(sha256.New, []byte(masterKey), []byte("vaultproxy-salt-v1"), []byte("vaultproxy-aes-key"))
	key := make([]byte, 32)
	if _, err := io.ReadFull(hkdfReader, key); err != nil {
		return nil, fmt.Errorf("derive key: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("new gcm: %w", err)
	}

	return &Service{db: db, gcm: gcm}, nil
}

func (s *Service) Encrypt(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, s.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return s.gcm.Seal(nonce, nonce, plaintext, nil), nil
}

func (s *Service) Decrypt(ciphertext []byte) ([]byte, error) {
	nonceSize := s.gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short")
	}
	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return s.gcm.Open(nil, nonce, ciphertext, nil)
}

func (s *Service) Store(orgID, name, provider, rawKey, alias string) (*APIKey, error) {
	id, err := generateID()
	if err != nil {
		return nil, fmt.Errorf("generate id: %w", err)
	}
	encrypted, err := s.Encrypt([]byte(rawKey))
	if err != nil {
		return nil, fmt.Errorf("encrypt: %w", err)
	}
	prefix := rawKey[:min(8, len(rawKey))] + "..."

	_, err = s.db.Exec(
		`INSERT INTO api_keys (id, org_id, name, provider, encrypted_key, key_prefix, alias)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, orgID, name, provider, encrypted, prefix, alias,
	)
	if err != nil {
		return nil, fmt.Errorf("insert: %w", err)
	}

	return &APIKey{
		ID:        id,
		OrgID:     orgID,
		Name:      name,
		Provider:  provider,
		KeyPrefix: prefix,
		Alias:     alias,
		IsActive:  true,
	}, nil
}

func (s *Service) Resolve(orgID, alias string) ([]byte, error) {
	var encrypted []byte
	err := s.db.QueryRow(
		`SELECT encrypted_key FROM api_keys WHERE alias = ? AND org_id = ? AND is_active = TRUE`,
		alias, orgID,
	).Scan(&encrypted)
	if err != nil {
		return nil, fmt.Errorf("resolve alias %q: %w", alias, err)
	}
	return s.Decrypt(encrypted)
}

func generateID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

