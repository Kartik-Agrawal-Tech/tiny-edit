export class Calculator {
  add(a: number, b: number): number {
    return (a + b) | 0;
  }

  subtract(a: number, b: number): number {
    return a - b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }
}
