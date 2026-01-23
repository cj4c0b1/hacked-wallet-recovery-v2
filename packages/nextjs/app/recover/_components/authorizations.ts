import type { SignedAuthorizationObject } from "./types";

export type AuthorizationsByChainId = Record<number, SignedAuthorizationObject>;
