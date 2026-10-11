import test from "node:test";
import assert from "node:assert/strict";
import { displayedDepartureStatus } from "./departure-status";
import type { Departure } from "../domain/types";

const departure: Departure = {
  id: "1",
  stopId: "2",
  line: "4",
  headsign: "Falchera",
  status: "live",
  sourceUpdatedAt: 1_000_000,
  source: "GTT",
};
test("live arrival ages without a successful network refresh", () => {
  assert.equal(
    displayedDepartureStatus(departure, 1_000_000, 1_030_000),
    "live",
  );
  assert.equal(
    displayedDepartureStatus(departure, 1_000_000, 1_121_000),
    "stale",
  );
});
test("older feed controls age even when entity timestamp looks current", () => {
  assert.equal(
    displayedDepartureStatus(departure, 800_000, 1_010_000),
    "stale",
  );
  assert.equal(
    displayedDepartureStatus(
      { ...departure, status: "cancelled" },
      800_000,
      1_010_000,
    ),
    "cancelled",
  );
});
