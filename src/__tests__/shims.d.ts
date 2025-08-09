declare module "shogun-core" {
  // Minimal surface used by tests
  export interface ShogunCore {
    db: any;
    isLoggedIn(): boolean;
  }
}
