package main

import "net/http"

// P3-W15-S01: only the health check so far; the match socket (/game/<id>/ws) comes
// with tickets and the match actor (P3-W15-S02, S03).
func newHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte("{\"status\":\"ok\"}\n"))
	})
	return mux
}
