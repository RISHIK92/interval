package judge

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const jobID = "3f6c2a54-9a7e-4b0e-8f1d-2b8c5d7e9a10"

func job(t *testing.T) JudgeJob {
	t.Helper()
	j, err := DecodeJudgeJob([]byte(`{"id":"` + jobID + `","priority":"ranked","language":"python",
		"files":[{"name":"main.py","content":"print(1)"}],"limits":{"seconds":2,"memoryMB":64},
		"runs":[{"stdin":""}],"submittedAt":"2026-11-13T10:00:00Z"}`))
	if err != nil {
		t.Fatal(err)
	}
	return j
}

// A Velox that answers 404 for a while, then the result.
func fakeVelox(t *testing.T, pending int, result string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var polls atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("POST /judge", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer key-1" {
			http.Error(w, "no", http.StatusUnauthorized)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		if _, err := DecodeJudgeJob(raw); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"` + jobID + `"}`))
	})
	mux.HandleFunc("GET /judge/{id}", func(w http.ResponseWriter, r *http.Request) {
		if polls.Add(1) <= int32(pending) {
			http.Error(w, "pending", http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(result))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, &polls
}

func velox(url, key string) Velox {
	return Velox{URL: url, APIKey: key, HTTP: http.DefaultClient, Poll: time.Millisecond}
}

func TestJudgeSubmitsThenPollsUntilTheResult(t *testing.T) {
	done := `{"id":"` + jobID + `","status":"done","runs":[{"verdict":"ok","timeMs":12}]}`
	srv, polls := fakeVelox(t, 3, done)
	got, err := velox(srv.URL, "key-1").Judge(context.Background(), job(t))
	if err != nil {
		t.Fatal(err)
	}
	if *got.Status != "done" || *got.Runs[0].Verdict != "ok" || polls.Load() != 4 {
		t.Fatalf("got %+v after %d polls", got, polls.Load())
	}
}

func TestJudgeFailsClearly(t *testing.T) {
	ctx := context.Background()
	srv, _ := fakeVelox(t, 0, `{"id":"`+jobID+`","runs":[]}`)
	if _, err := velox(srv.URL, "wrong").Judge(ctx, job(t)); err == nil || !strings.Contains(err.Error(), "401") {
		t.Errorf("a refused key: %v", err)
	}
	// Velox's answer is held to the contract: a result has a status.
	if _, err := velox(srv.URL, "key-1").Judge(ctx, job(t)); err == nil || !strings.Contains(err.Error(), "contract") {
		t.Errorf("a malformed result: %v", err)
	}
	other, _ := fakeVelox(t, 0, `{"id":"00000000-0000-4000-8000-000000000000","status":"done","runs":[{"verdict":"ok","timeMs":1}]}`)
	if _, err := velox(other.URL, "key-1").Judge(ctx, job(t)); err == nil || !strings.Contains(err.Error(), "asked for") {
		t.Errorf("another job's result: %v", err)
	}
	bad := job(t)
	bad.Runs = nil
	if _, err := velox(srv.URL, "key-1").Judge(ctx, bad); err == nil || !strings.Contains(err.Error(), "not a JudgeJob") {
		t.Errorf("an invalid job sent: %v", err)
	}
}

func TestJudgeStopsWithItsContext(t *testing.T) {
	srv, _ := fakeVelox(t, 1_000_000, "")
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := velox(srv.URL, "key-1").Judge(ctx, job(t)); err == nil {
		t.Fatal("no error past the deadline")
	}
}

// One failed poll (a 502 from a proxy) doesn't lose an accepted job; many do.
func TestJudgeRidesOutABriefOutage(t *testing.T) {
	var polls atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("POST /judge", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusAccepted) })
	mux.HandleFunc("GET /judge/{id}", func(w http.ResponseWriter, _ *http.Request) {
		switch polls.Add(1) {
		case 1, 2:
			http.Error(w, "bad gateway", http.StatusBadGateway)
		default:
			_, _ = w.Write([]byte(`{"id":"` + jobID + `","status":"done","runs":[]}`))
		}
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()
	if _, err := velox(srv.URL, "k").Judge(context.Background(), job(t)); err != nil {
		t.Fatalf("two 502s, then the result: %v", err)
	}
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer down.Close()
	if _, err := velox(down.URL, "k").Judge(context.Background(), job(t)); err == nil || !strings.Contains(err.Error(), "503") {
		t.Fatalf("a judge that stays down: %v", err)
	}
	// A zero Poll waits the default, not a hot loop: two polls take at least 250 ms.
	start := time.Now()
	slow, _ := fakeVelox(t, 1, `{"id":"`+jobID+`","status":"done","runs":[]}`)
	if _, err := (Velox{URL: slow.URL, APIKey: "key-1", HTTP: http.DefaultClient}).Judge(context.Background(), job(t)); err != nil {
		t.Fatal(err)
	}
	if time.Since(start) < defaultPoll {
		t.Fatal("polled without waiting")
	}
}
