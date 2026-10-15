package config

import "testing"

func TestDotEnvValue(t *testing.T) {
	cases := map[string]string{
		"development":                         "development",
		"development   # development or prod": "development",
		"  :8100\t# port":                     ":8100",
		`"a # not a comment"`:                 "a # not a comment",
		`'single'`:                            "single",
		"pass#word":                           "pass#word",
		"":                                    "",
		"# only a comment":                    "# only a comment",
	}
	for in, want := range cases {
		if got := dotEnvValue(in); got != want {
			t.Errorf("dotEnvValue(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestEmails(t *testing.T) {
	got := emails(" Main@Example.com, backup@example.com,,main@example.com ")
	if len(got) != 2 || got[0] != "main@example.com" || got[1] != "backup@example.com" {
		t.Errorf("emails() = %v", got)
	}
}
