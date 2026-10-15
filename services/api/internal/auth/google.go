package auth

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const googleIssuer = "https://accounts.google.com"

// google wraps the OAuth client. The OIDC provider is discovered on first use, so the
// server starts even when Google is unreachable or not configured yet.
type google struct {
	clientID, clientSecret, redirectURL string

	mu       sync.Mutex
	oauth    *oauth2.Config
	verifier *oidc.IDTokenVerifier
}

type googleIdentity struct {
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Nonce         string `json:"nonce"`
}

var errGoogleNotConfigured = errors.New("google sign-in is not configured")

func (g *google) configured() bool { return g.clientID != "" && g.clientSecret != "" }

func (g *google) init(ctx context.Context) (*oauth2.Config, *oidc.IDTokenVerifier, error) {
	if !g.configured() {
		return nil, nil, errGoogleNotConfigured
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.oauth != nil {
		return g.oauth, g.verifier, nil
	}
	provider, err := oidc.NewProvider(ctx, googleIssuer)
	if err != nil {
		return nil, nil, fmt.Errorf("discover google provider: %w", err)
	}
	g.oauth = &oauth2.Config{
		ClientID:     g.clientID,
		ClientSecret: g.clientSecret,
		RedirectURL:  g.redirectURL,
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "email"},
	}
	g.verifier = provider.Verifier(&oidc.Config{ClientID: g.clientID})
	return g.oauth, g.verifier, nil
}

// authURL builds the consent URL with state, nonce and a PKCE challenge.
func (g *google) authURL(ctx context.Context, state, nonce, verifier string) (string, error) {
	cfg, _, err := g.init(ctx)
	if err != nil {
		return "", err
	}
	return cfg.AuthCodeURL(state,
		oauth2.S256ChallengeOption(verifier),
		oidc.Nonce(nonce),
		oauth2.SetAuthURLParam("prompt", "select_account"),
	), nil
}

// exchange trades the code for tokens and returns the verified identity.
func (g *google) exchange(ctx context.Context, code, verifier, nonce string) (googleIdentity, error) {
	cfg, idVerifier, err := g.init(ctx)
	if err != nil {
		return googleIdentity{}, err
	}
	tok, err := cfg.Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		return googleIdentity{}, fmt.Errorf("exchange code: %w", err)
	}
	raw, ok := tok.Extra("id_token").(string)
	if !ok || raw == "" {
		return googleIdentity{}, errors.New("token response has no id_token")
	}
	idToken, err := idVerifier.Verify(ctx, raw)
	if err != nil {
		return googleIdentity{}, fmt.Errorf("verify id_token: %w", err)
	}
	var id googleIdentity
	if err := idToken.Claims(&id); err != nil {
		return googleIdentity{}, fmt.Errorf("read claims: %w", err)
	}
	if id.Nonce != nonce {
		return googleIdentity{}, errors.New("nonce mismatch")
	}
	return id, nil
}
