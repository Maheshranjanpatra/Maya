from app.db import one, rows


def test_syllabus_is_not_saved_before_review_confirmation(maya):
    app, client = maya
    extraction = {
        "subjects": [
            {
                "name": "Physics",
                "units": [
                    {
                        "name": "Mechanics",
                        "order": 1,
                        "topics": [
                            {
                                "name": "Kinematics",
                                "marks": 10,
                                "est_hours": 2,
                                "difficulty": 2,
                                "confidence": 0.95,
                                "prerequisites": [],
                                "subtopics": [],
                            },
                            {
                                "name": "Rotation",
                                "marks": 15,
                                "est_hours": 3,
                                "difficulty": 4,
                                "confidence": 0.55,
                                "prerequisites": ["Kinematics"],
                                "subtopics": ["Angular velocity"],
                            },
                        ],
                    }
                ],
            }
        ],
        "warnings": [],
    }

    with app.app_context():
        assert one("SELECT COUNT(*) AS count FROM subject")["count"] == 0

    response = client.post("/api/extract/commit", json={"extraction": extraction})

    assert response.status_code == 200
    result = response.get_json()["data"]
    assert len(result["subject_ids"]) == 1
    with app.app_context():
        assert one("SELECT COUNT(*) AS count FROM subject")["count"] == 1
        topics = rows("SELECT id,name,parent_topic_id FROM topic ORDER BY id")
        assert len(topics) == 3
        assert topics[2]["parent_topic_id"] == topics[1]["id"]
        edge = one(
            "SELECT topic_id,prereq_topic_id FROM prereq "
            "WHERE topic_id=(SELECT id FROM topic WHERE name='Rotation')"
        )
        assert edge["prereq_topic_id"] == topics[0]["id"]
        assert one("SELECT COUNT(*) AS count FROM task")["count"] >= 4


def test_subject_limit_and_web_lock(maya):
    _, client = maya
    for index in range(12):
        response = client.post("/api/subjects", json={"name": f"Subject {index}"})
        assert response.status_code == 200
        if index == 9:
            assert response.get_json()["data"]["soft_cap_warning"]

    assert client.post("/api/subjects", json={"name": "Subject 13"}).status_code == 409
    assert client.patch("/api/settings", json={"web_lock_key": "private-key"}).status_code == 200
    assert client.get("/api/subjects").status_code == 401
    assert client.get("/api/subjects", headers={"X-Web-Lock-Key": "private-key"}).status_code == 200
    assert client.get("/api/settings").status_code == 200


def test_task_completion_awards_once_and_creates_spaced_revisions(maya):
    app, client = maya
    subject_id = client.post("/api/subjects", json={"name": "Biology"}).get_json()["data"]["id"]
    unit_id = client.post(
        f"/api/subjects/{subject_id}/units",
        json={"name": "Cells"},
    ).get_json()["data"]["id"]
    client.post(
        f"/api/units/{unit_id}/topics",
        json={"name": "Cell structure", "est_minutes": 60},
    )

    with app.app_context():
        task = one("SELECT * FROM task WHERE type='read'")
    assert client.patch(f"/api/tasks/{task['id']}", json={"status": "done"}).status_code == 200
    with app.app_context():
        assert one(
            "SELECT COUNT(*) AS count FROM task WHERE topic_id=? AND is_revision=1",
            (task["topic_id"],),
        )["count"] == 3
        initial_xp = one("SELECT SUM(amount) AS total FROM xp_event")["total"]
        assert initial_xp > 0

    client.patch(f"/api/tasks/{task['id']}", json={"status": "pending"})
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    with app.app_context():
        assert one(
            "SELECT COUNT(*) AS count FROM xp_event WHERE ref_id=? AND reason='Task completed' AND amount>0",
            (task["id"],),
        )["count"] == 1
        assert one("SELECT SUM(amount) AS total FROM xp_event")["total"] == 0


def test_ai_features_explain_missing_key_without_crashing(maya):
    _, client = maya
    response = client.post(
        "/api/upload",
        data={"pasted_text": "Unit one: cells"},
    )
    assert response.status_code == 503
    assert "Gemini API key" in response.get_json()["error"]
