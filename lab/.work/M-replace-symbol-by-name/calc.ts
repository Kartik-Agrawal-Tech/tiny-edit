export class Calculator {
  add(a: number, b: number): number {
    return Math.trunc(a + b);
  }

  subtract(a: number, b: number): number {
    return a - b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }
}
