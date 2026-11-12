import heapq
import logging


def compute_priority(topic, downstream_marks=0):
    hours = max(float(topic.get("est_minutes", 60)) / 60, 0.1)
    return (float(topic.get("marks", 0)) + 0.5 * downstream_marks) / hours


def _topic_graph(topics):
    by_id = {topic["id"]: topic for topic in topics}
    edges = {
        topic_id: {
            prerequisite
            for prerequisite in topic.get("prereqs", [])
            if prerequisite in by_id and prerequisite != topic_id
        }
        for topic_id, topic in by_id.items()
    }
    return by_id, edges


def _sort_graph(by_id, edges, priorities):
    dependents = {topic_id: [] for topic_id in by_id}
    indegree = {topic_id: len(prerequisites) for topic_id, prerequisites in edges.items()}
    for topic_id, prerequisites in edges.items():
        for prerequisite in prerequisites:
            dependents[prerequisite].append(topic_id)

    ready = [
        (-priorities[topic_id], str(topic_id), topic_id)
        for topic_id, degree in indegree.items()
        if degree == 0
    ]
    heapq.heapify(ready)
    ordered = []
    while ready:
        _, _, topic_id = heapq.heappop(ready)
        ordered.append(topic_id)
        for dependent in dependents[topic_id]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                heapq.heappush(
                    ready, (-priorities[dependent], str(dependent), dependent)
                )
    return ordered, indegree


def _cycle_edges(by_id, edges, remaining):
    index = 0
    indices = {}
    lowlinks = {}
    stack = []
    on_stack = set()
    components = []

    def visit(topic_id):
        nonlocal index
        indices[topic_id] = lowlinks[topic_id] = index
        index += 1
        stack.append(topic_id)
        on_stack.add(topic_id)

        for prerequisite in edges[topic_id]:
            if prerequisite not in remaining:
                continue
            if prerequisite not in indices:
                visit(prerequisite)
                lowlinks[topic_id] = min(lowlinks[topic_id], lowlinks[prerequisite])
            elif prerequisite in on_stack:
                lowlinks[topic_id] = min(lowlinks[topic_id], indices[prerequisite])

        if lowlinks[topic_id] == indices[topic_id]:
            component = set()
            while True:
                member = stack.pop()
                on_stack.remove(member)
                component.add(member)
                if member == topic_id:
                    break
            components.append(component)

    for topic_id in by_id:
        if topic_id in remaining and topic_id not in indices:
            visit(topic_id)

    return [
        (topic_id, prerequisite)
        for component in components
        if len(component) > 1
        for topic_id in component
        for prerequisite in edges[topic_id]
        if prerequisite in component
    ]


def topological_order_with_edges(topics):
    """Return prerequisite-safe topic IDs and warnings, dropping the least valuable
    edge in each detected cycle rather than leaving topics in a false order.
    """
    by_id, edges = _topic_graph(topics)
    direct_priorities = {
        topic_id: compute_priority(topic)
        for topic_id, topic in by_id.items()
    }
    warnings = []

    while True:
        provisional_order, remaining = _sort_graph(by_id, edges, direct_priorities)
        if len(provisional_order) == len(by_id):
            break

        cycle_nodes = {
            topic_id for topic_id, degree in remaining.items() if degree > 0
        }
        cycle_edges = _cycle_edges(by_id, edges, cycle_nodes)
        if not cycle_edges:
            break

        dropped_topic, dropped_prerequisite = min(
            cycle_edges,
            key=lambda edge: (
                direct_priorities[edge[0]],
                str(edge[0]),
                str(edge[1]),
            ),
        )
        edges[dropped_topic].remove(dropped_prerequisite)
        warning = (
            "Dependency cycle detected; dropped the lowest-priority edge "
            f"{dropped_prerequisite} -> {dropped_topic}."
        )
        logging.getLogger(__name__).warning(warning)
        warnings.append(warning)

    order, _ = _sort_graph(by_id, edges, direct_priorities)
    descendants = {topic_id: set() for topic_id in by_id}
    for topic_id in reversed(order):
        for dependent, prerequisites in edges.items():
            if topic_id in prerequisites:
                descendants[topic_id].add(dependent)
                descendants[topic_id].update(descendants[dependent])

    priorities = {
        topic_id: compute_priority(
            topic,
            sum(float(by_id[child].get("marks", 0)) for child in descendants[topic_id]),
        )
        for topic_id, topic in by_id.items()
    }
    ordered, _ = _sort_graph(by_id, edges, priorities)
    valid_edges = {
        topic_id: sorted(prerequisites, key=str)
        for topic_id, prerequisites in edges.items()
    }
    return ordered, warnings, valid_edges, priorities


def topological_order(topics):
    ordered, warnings, _, _ = topological_order_with_edges(topics)
    return ordered, warnings
