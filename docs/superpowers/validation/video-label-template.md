# Validation Video Label

- video_id:
- file_name:
- exercise_type: squat | push-up
- expected_view:
- actual_view_note:
- expected_gate_result: pass | withhold
- expected_withhold_reason:
- expected_rep_result_summary:
- major_observed_issues:
- notes:

## 작성 예시

```yaml
video_id: PU_003
file_name: pushup_side_partial_arm.mp4
exercise_type: push-up
expected_view: SIDE
actual_view_note: side angle is mostly correct but right arm visibility drops intermittently
expected_gate_result: withhold
expected_withhold_reason: key_joints_not_visible
expected_rep_result_summary: no reliable scoring should occur
major_observed_issues: elbow/wrist visibility unstable, partial truncation
notes: should not be treated as low-score push-up attempt
```

## 최소 라벨 기준

모든 검증 영상은 최소 아래 항목을 포함해야 한다.

1. **운동 종류** — `exercise_type`
2. **기대 view** — `expected_view`
3. **채점 가능 여부 정답** — `expected_gate_result`
4. **보류 정답 사유 또는 정상 채점 기대** — `expected_withhold_reason`
5. **주요 관찰 문제** — `major_observed_issues`