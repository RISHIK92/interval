package main

import "sort"

// A pod owns its containers: they are created inside it and go with it.
type PodRegistry struct {
	pods      map[string]map[string]string
	podOfName map[string]string
	sidecars  map[string]string
}

func NewPodRegistry() *PodRegistry {
	return &PodRegistry{
		pods:      map[string]map[string]string{},
		podOfName: map[string]string{},
		sidecars:  map[string]string{},
	}
}

func podNamed(names ...string) {
	for _, n := range names {
		if n == "" {
			panic("names and images are not empty")
		}
	}
}

func (r *PodRegistry) createPod(pod string) {
	podNamed(pod)
	if _, ok := r.pods[pod]; ok {
		panic("pod already exists")
	}
	injected := map[string]string{}
	for name, image := range r.sidecars {
		injected[pod+"-"+name] = image
	}
	for name := range injected {
		if _, taken := r.podOfName[name]; taken {
			panic("a sidecar's name is taken")
		}
	}
	r.pods[pod] = map[string]string{}
	for name, image := range injected {
		r.place(pod, name, image)
	}
}

func (r *PodRegistry) place(pod, container, image string) {
	r.pods[pod][container] = image
	r.podOfName[container] = pod
}

func (r *PodRegistry) addContainer(pod string, container string, image string) bool {
	podNamed(pod, container, image)
	if _, ok := r.pods[pod]; !ok {
		return false
	}
	if _, taken := r.podOfName[container]; taken {
		return false
	}
	r.place(pod, container, image)
	return true
}

func (r *PodRegistry) removePod(pod string) int64 {
	podNamed(pod)
	owned, ok := r.pods[pod]
	if !ok {
		panic("unknown pod")
	}
	for container := range owned {
		delete(r.podOfName, container)
	}
	delete(r.pods, pod)
	return int64(len(owned))
}

func (r *PodRegistry) podOf(container string) *string {
	podNamed(container)
	pod, ok := r.podOfName[container]
	if !ok {
		return nil
	}
	return &pod
}

func (r *PodRegistry) images() []string {
	all := map[string]bool{}
	for _, owned := range r.pods {
		for _, image := range owned {
			all[image] = true
		}
	}
	out := []string{}
	for image := range all {
		out = append(out, image)
	}
	sort.Strings(out)
	return out
}

// The extension round: containers injected into every pod created afterwards.
func (r *PodRegistry) sidecar(container string, image string) {
	podNamed(container, image)
	if _, ok := r.sidecars[container]; ok {
		panic("sidecar already registered")
	}
	r.sidecars[container] = image
}
