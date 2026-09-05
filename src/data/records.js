import data from "./records.json";

export const sampleRecords = data;

export function generateId() {
  return Date.now() + Math.random();
}
