import type { Coordinate } from '../../domain/types';
import { angleDelta, bearingDegrees, distanceMeters } from './route-measure';

/**
 * Presentation-only motion for providers that omit speed or course (some platforms, test
 * providers). A displacement counts only when it exceeds the combined horizontal accuracy of the
 * two fixes (and at least `minimumMeters`), measured against the most recent earlier fix that it
 * clears within `windowMs`; entering "moving" needs two consecutive consistent estimates, while one
 * inconclusive fix returns to stationary. Stationary jitter therefore yields no speed and no course,
 * and the course accuracy reports the real geometric uncertainty instead of a fixed guess.
 */
export interface EstimatedMotion {
  /** 0 while stationary or unproven. */
  speedMps: number;
  course?: number;
  courseAccuracyDegrees?: number;
  moving: boolean;
}

interface Sample { coordinate: Coordinate; ms: number; accuracy: number }

export class MotionEstimator {
  private samples: Sample[] = [];
  private streak = 0;
  private lastCourse: number | null = null;
  private result: EstimatedMotion = { speedMps: 0, moving: false };

  constructor(private readonly windowMs = 10_000, private readonly minimumMeters = 3, private readonly consistencyDegrees = 60) {}

  get current(): EstimatedMotion { return this.result; }

  /** One distinct fix (a repeated sample time returns the previous estimate). */
  update(coordinate: Coordinate, ms: number, accuracyMeters: number): EstimatedMotion {
    const last = this.samples[this.samples.length - 1];
    if (last && ms <= last.ms) return this.result;
    const accuracy = Number.isFinite(accuracyMeters) && accuracyMeters > 0 ? accuracyMeters : 50;
    this.samples.push({ coordinate, ms, accuracy });
    while (this.samples.length > 1 && ms - this.samples[0]!.ms > this.windowMs) this.samples.shift();
    // Speed: the most recent earlier fix the displacement clears. Course: prefer a baseline twice
    // the uncertainty (about 27° at worst), falling back to the clearing fix with its honest error.
    let found: { distance: number; seconds: number; course: number; uncertainty: number } | null = null;
    let heading: { course: number; distance: number; uncertainty: number } | null = null;
    for (let i = this.samples.length - 2; i >= 0; i -= 1) {
      const earlier = this.samples[i]!;
      const uncertainty = Math.max(this.minimumMeters, Math.hypot(earlier.accuracy, accuracy));
      const distance = distanceMeters(earlier.coordinate, coordinate);
      if (!found && distance > uncertainty) {
        found = { distance, seconds: (ms - earlier.ms) / 1000, course: bearingDegrees(earlier.coordinate, coordinate), uncertainty };
      }
      if (found && distance >= 2 * uncertainty) { heading = { course: bearingDegrees(earlier.coordinate, coordinate), distance, uncertainty }; break; }
    }
    if (found && heading) found = { ...found, course: heading.course };
    if (!found || found.seconds <= 0) {
      this.streak = 0; this.lastCourse = null;
      this.result = { speedMps: 0, moving: false };
      return this.result;
    }
    const consistent = this.lastCourse !== null && Math.abs(angleDelta(this.lastCourse, found.course)) <= this.consistencyDegrees;
    this.streak = consistent ? this.streak + 1 : 1;
    this.lastCourse = found.course;
    if (this.streak < 2) { this.result = { speedMps: 0, moving: false }; return this.result; }
    const baseline = heading ?? found;
    this.result = {
      speedMps: found.distance / found.seconds, course: found.course, moving: true,
      courseAccuracyDegrees: Math.min(90, Math.atan2(baseline.uncertainty, baseline.distance) * 180 / Math.PI),
    };
    return this.result;
  }
}
