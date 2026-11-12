from app.dag_engine import topological_order, topological_order_with_edges


def test_prerequisites_are_ordered_before_dependents_and_calls_are_repeatable():
    topics = [
        {"id": 1, "marks": 2, "est_minutes": 60, "prereqs": []},
        {"id": 2, "marks": 10, "est_minutes": 60, "prereqs": [1]},
        {"id": 3, "marks": 20, "est_minutes": 60, "prereqs": []},
    ]

    order, warnings = topological_order(topics)

    assert not warnings
    assert order.index(1) < order.index(2)
    assert topological_order(topics) == (order, warnings)


def test_cycle_drops_the_edge_with_the_lowest_priority_dependent():
    topics = [
        {"id": 1, "marks": 1, "est_minutes": 60, "prereqs": [2]},
        {"id": 2, "marks": 10, "est_minutes": 60, "prereqs": [1]},
    ]

    order, warnings, edges, _ = topological_order_with_edges(topics)

    assert len(order) == 2
    assert len(warnings) == 1
    assert edges[1] == []
    assert edges[2] == [1]
