use ferrostar::deviation_detection::{RouteDeviation, RouteDeviationTracking};
use ferrostar::models::{BoundingBox, GeographicCoordinate, Route, RouteStep, UserLocation};
use ferrostar::navigation_controller::{
    create_navigator,
    models::{CourseFiltering, NavigationControllerConfig, TripState, WaypointAdvanceMode},
    step_advance::SerializableStepAdvanceCondition,
};
use serde_json::Value;
use std::time::{Duration, SystemTime};

// This is the same asset Gradle embeds in the Android module's BuildConfig.
const POLICY: &str = include_str!(
    "../../../modules/avoid-navigation/android/src/main/assets/road-guidance-policy.json"
);
fn policy() -> Value {
    serde_json::from_str(POLICY).unwrap()
}
fn config(mode: &str) -> NavigationControllerConfig {
    let p = policy();
    let m = &p[mode];
    let accuracy = p["maximumHorizontalAccuracyMeters"].as_u64().unwrap() as u16;
    let entry = m["entryRadiusMeters"].as_u64().unwrap() as u16;
    let exit = m["exitDistanceMeters"].as_u64().unwrap() as u16;
    let condition = match m["strategy"].as_str().unwrap() {
        "entry-snapped-exit" => SerializableStepAdvanceCondition::DistanceEntryAndSnappedExit {
            distance_to_end_of_step: entry,
            distance_after_end_step: exit,
            minimum_horizontal_accuracy: accuracy,
            has_reached_end_of_current_step: false,
        },
        _ => panic!("Unknown shipped strategy"),
    };
    NavigationControllerConfig {
        waypoint_advance: WaypointAdvanceMode::WaypointWithinRange(
            p["arrivalRadiusMeters"].as_f64().unwrap(),
        ),
        step_advance_condition: condition.into(),
        arrival_step_advance_condition: SerializableStepAdvanceCondition::DistanceToEndOfStep {
            distance: p["arrivalRadiusMeters"].as_u64().unwrap() as u16,
            minimum_horizontal_accuracy: p["maximumHorizontalAccuracyMeters"].as_u64().unwrap()
                as u16,
        }
        .into(),
        route_deviation_tracking: RouteDeviationTracking::StaticThreshold {
            minimum_horizontal_accuracy: accuracy,
            max_acceptable_deviation: p["maximumRouteDeviationMeters"].as_f64().unwrap(),
        },
        snapped_location_course_filtering: CourseFiltering::SnapToRoute,
    }
}
fn coordinate(x: f64, y: f64) -> GeographicCoordinate {
    GeographicCoordinate {
        lat: y / 111_195.0,
        lng: x / 111_195.0,
    }
}
fn fix(x: f64, y: f64, accuracy: f64, second: u64) -> UserLocation {
    UserLocation {
        coordinates: coordinate(x, y),
        horizontal_accuracy: accuracy,
        course_over_ground: None,
        timestamp: SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000 + second),
        speed: None,
    }
}
fn route(points: &[(f64, f64)]) -> Route {
    let mut steps = points
        .windows(2)
        .enumerate()
        .map(|(index, pair)| {
            let distance = (pair[1].0 - pair[0].0).hypot(pair[1].1 - pair[0].1);
            RouteStep {
                geometry: pair.iter().map(|&(x, y)| coordinate(x, y)).collect(),
                distance,
                duration: distance / 10.0,
                road_name: None,
                exits: vec![],
                instruction: format!("step-{index}"),
                visual_instructions: vec![],
                spoken_instructions: vec![],
                annotations: None,
                incidents: vec![],
                driving_side: None,
                roundabout_exit_number: None,
            }
        })
        .collect::<Vec<_>>();
    let end = coordinate(points.last().unwrap().0, points.last().unwrap().1);
    let mut arrival = steps.last().unwrap().clone();
    arrival.geometry = vec![end, end];
    arrival.distance = 0.0;
    arrival.duration = 0.0;
    arrival.instruction = "arrival".into();
    steps.push(arrival);
    Route {
        geometry: points.iter().map(|&(x, y)| coordinate(x, y)).collect(),
        bbox: BoundingBox {
            sw: coordinate(-200.0, -200.0),
            ne: coordinate(300.0, 300.0),
        },
        distance: steps.iter().map(|s| s.distance).sum(),
        waypoints: vec![],
        steps,
    }
}
fn remaining(state: TripState) -> usize {
    match state {
        TripState::Navigating {
            remaining_steps, ..
        } => remaining_steps.len(),
        TripState::Complete { .. } => 0,
        _ => panic!("Unexpected idle"),
    }
}
fn corner_route() -> Route {
    route(&[
        (-100.0, 0.0),
        (0.0, 0.0),
        (0.0, 100.0),
        (100.0, 100.0),
        (100.0, 200.0),
    ])
}

#[test]
fn sparse_driving_fix_crosses_corner_without_entering_old_five_metre_circle() {
    for mode in ["car", "bicycle"] {
        let navigator = create_navigator(corner_route(), config(mode), false);
        let mut state = navigator.get_initial_state(fix(-50.0, 0.0, 5.0, 0));
        for (second, (x, y)) in [
            (-8.0, 0.0),
            (0.0, 8.0),
            (0.0, 22.0),
            (0.0, 36.0),
            (0.0, 50.0),
        ]
        .into_iter()
        .enumerate()
        {
            state = navigator.update_user_location(fix(x, y, 5.0, second as u64 + 1), state);
        }
        assert_eq!(
            remaining(state.trip_state()),
            4,
            "{mode} must advance after completing the turn"
        );
    }
}

#[test]
fn walking_sidewalk_does_not_advance_until_snapped_position_passes_corner() {
    let navigator = create_navigator(corner_route(), config("walk"), false);
    let mut state = navigator.get_initial_state(fix(-30.0, 8.0, 8.0, 0));
    for (second, x) in [-15.0, -8.0, -3.0].into_iter().enumerate() {
        state = navigator.update_user_location(fix(x, 8.0, 8.0, second as u64 + 1), state);
        assert_eq!(
            remaining(state.trip_state()),
            5,
            "sidewalk offset must not complete the turn early"
        );
    }
    state = navigator.update_user_location(fix(0.0, 13.0, 8.0, 4), state);
    assert_eq!(remaining(state.trip_state()), 4);
}

#[test]
fn every_accepted_accuracy_keeps_step_and_deviation_analysis_enabled() {
    let accepted = policy()["maximumHorizontalAccuracyMeters"]
        .as_f64()
        .unwrap();
    for mode in ["walk", "bicycle", "car"] {
        for accuracy in [1.0, 10.0, accepted] {
            let navigator = create_navigator(corner_route(), config(mode), false);
            let mut state = navigator.get_initial_state(fix(-8.0, 0.0, accuracy, 0));
            for (i, (x, y)) in [(-8.0, 0.0), (0.0, 8.0), (0.0, 22.0)]
                .into_iter()
                .enumerate()
            {
                state = navigator.update_user_location(fix(x, y, accuracy, i as u64 + 1), state);
            }
            assert_eq!(
                remaining(state.trip_state()),
                4,
                "{mode}: accepted {accuracy}m fix must advance"
            );
            state = navigator.update_user_location(fix(-100.0, 100.0, accuracy, 4), state);
            state = navigator.update_user_location(fix(-100.0, 100.0, accuracy, 5), state);
            let TripState::Navigating { deviation, .. } = state.trip_state() else {
                panic!("Unexpected completion")
            };
            assert!(
                matches!(deviation, RouteDeviation::Deviation { .. }),
                "{mode}: accepted {accuracy}m fix must detect deviation"
            );
        }
    }
}

#[test]
fn final_short_step_and_arrival_do_not_require_passing_destination_or_better_accuracy() {
    for mode in ["walk", "bicycle", "car"] {
        let navigator = create_navigator(
            route(&[(-100.0, 0.0), (0.0, 0.0), (0.0, 3.0)]),
            config(mode),
            false,
        );
        let mut state = navigator.get_initial_state(fix(-30.0, 0.0, 20.0, 0));
        for (i, (x, y)) in [(-8.0, 0.0), (0.0, 3.0), (0.0, 3.0), (0.0, 3.0)]
            .into_iter()
            .enumerate()
        {
            state = navigator.update_user_location(fix(x, y, 20.0, i as u64 + 1), state);
        }
        assert_eq!(
            remaining(state.trip_state()),
            0,
            "{mode} arrival must work at accepted 20m accuracy"
        );
    }
}
