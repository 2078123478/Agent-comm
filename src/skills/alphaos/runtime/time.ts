export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}
