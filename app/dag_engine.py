import heapq
def compute_priority(topic, downstream_marks):
    return (float(topic.get('marks',0))+0.5*downstream_marks)/max(float(topic.get('est_minutes',60))/60,0.1)
def topological_order(topics):
    by={t['id']:t for t in topics}; edges={i:[] for i in by}; indeg={i:0 for i in by}
    for t in topics:
        for p in t.get('prereqs',[]):
            if p in by: edges[p].append(t['id']); indeg[t['id']]+=1
    downstream={}
    def reach(i,seen):
        for n in edges[i]:
            if n not in seen: seen.add(n); reach(n,seen)
        return seen
    for i in by: downstream[i]=sum(float(by[n].get('marks',0)) for n in reach(i,set()))
    score={i:compute_priority(by[i],downstream[i]) for i in by}
    q=[(-score[i],i) for i in by if indeg[i]==0]; heapq.heapify(q); out=[]
    while q:
        _,i=heapq.heappop(q); out.append(i)
        for n in edges[i]:
            indeg[n]-=1
            if indeg[n]==0: heapq.heappush(q,(-score[n],n))
    warnings=[]
    if len(out)<len(by):
        warnings.append('Dependency cycle detected; remaining topics appended by priority.')
        out.extend(sorted((i for i in by if i not in out),key=lambda i:-score[i]))
    return out,warnings
