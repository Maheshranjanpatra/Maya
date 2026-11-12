def _escape(value):
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def calendar_text(tasks, exams=()):
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Maya//Study Planner//EN",
        "CALSCALE:GREGORIAN",
    ]
    for task in tasks:
        scheduled = task.get("scheduled_date")
        if scheduled:
            stamp = scheduled.replace("-", "")
            lines.extend(
                [
                    "BEGIN:VEVENT",
                    f"UID:maya-task-{task['id']}@local",
                    f"DTSTART;VALUE=DATE:{stamp}",
                    f"SUMMARY:{_escape(task['title'])}",
                    "END:VEVENT",
                ]
            )
    for exam in exams:
        stamp = exam["exam_date"].replace("-", "")
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:maya-exam-{exam['id']}@local",
                f"DTSTART;VALUE=DATE:{stamp}",
                f"SUMMARY:{_escape(exam.get('subject_name', 'Exam'))} "
                f"{_escape(exam.get('exam_type', 'exam'))}",
                "END:VEVENT",
            ]
        )
    return "\r\n".join(lines + ["END:VCALENDAR", ""])
