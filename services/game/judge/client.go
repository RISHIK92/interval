package judge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// P5-W31-S02b (ADR-0041 PROPOSED, Q-P5-15): the game server judges battle code on Velox,
// in Interval's JudgeJob/JudgeResult contract (packages/judge). A job is posted once
// (its id is its idempotency key, LOAD-5; Velox answers 202 again when the same key
// resubmits its own id), then its result is polled until it's there or the caller's
// context ends: the caller bounds the whole wait.

const (
	defaultPoll = 250 * time.Millisecond
	// Each request on its own: a stalled connection mustn't hold the wait.
	requestTimeout = 10 * time.Second
	// Polls in a row that fail before the job is given up: one 502 shouldn't lose it.
	pollRetries = 3
	// A result returns a job's outputs only when asked (LLDQ-4): a few MB at most.
	maxResultBytes = 16 << 20
)

// Judge is what a battle needs from a judge; Velox is one, tests use a fake.
type Judge interface {
	Judge(ctx context.Context, job JudgeJob) (JudgeResult, error)
}

// Velox speaks to Velox's /judge over HTTP with an operator-listed API key.
type Velox struct {
	URL    string
	APIKey string
	HTTP   *http.Client
	// Between polls for a result.
	Poll time.Duration
}

func (v Velox) Judge(ctx context.Context, job JudgeJob) (JudgeResult, error) {
	if err := job.Validate(); err != nil {
		return JudgeResult{}, fmt.Errorf("judge: not a JudgeJob: %w", err)
	}
	body, err := json.Marshal(job)
	if err != nil {
		return JudgeResult{}, err
	}
	status, _, err := v.do(ctx, http.MethodPost, "/judge", body)
	if err != nil {
		return JudgeResult{}, err
	}
	if status != http.StatusAccepted {
		return JudgeResult{}, fmt.Errorf("judge: submit answered %d", status)
	}
	poll := v.Poll
	if poll <= 0 {
		poll = defaultPoll
	}
	failed := 0
	for {
		// The id is a UUID (Validate), safe in a path.
		status, raw, err := v.do(ctx, http.MethodGet, "/judge/"+*job.Id, nil)
		if (err != nil && ctx.Err() == nil) || status >= 500 {
			if failed++; failed > pollRetries {
				if err == nil {
					err = fmt.Errorf("judge: result answered %d", status)
				}
				return JudgeResult{}, err
			}
			status = http.StatusNotFound // as pending: poll again
		} else if err != nil {
			return JudgeResult{}, err
		} else {
			failed = 0
		}
		switch status {
		case http.StatusOK:
			// Velox's answer is held to the contract like any input.
			result, err := DecodeJudgeResult(raw)
			if err != nil {
				return JudgeResult{}, fmt.Errorf("judge: a result outside the contract: %w", err)
			}
			if *result.Id != *job.Id {
				return JudgeResult{}, fmt.Errorf("judge: asked for %s, answered %s", *job.Id, *result.Id)
			}
			return result, nil
		case http.StatusNotFound:
		default:
			return JudgeResult{}, fmt.Errorf("judge: result answered %d", status)
		}
		select {
		case <-ctx.Done():
			return JudgeResult{}, ctx.Err()
		case <-time.After(poll):
		}
	}
}

func (v Velox) do(ctx context.Context, method, path string, body []byte) (int, []byte, error) {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, v.URL+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+v.APIKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := v.HTTP.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("judge: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResultBytes+1))
	if err != nil {
		return 0, nil, fmt.Errorf("judge: %w", err)
	}
	if len(raw) > maxResultBytes {
		return 0, nil, fmt.Errorf("judge: an answer over %d bytes", maxResultBytes)
	}
	return resp.StatusCode, raw, nil
}
