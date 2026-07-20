export interface LicenseStatus {
  activated: boolean;
  canUseApp: boolean;
  trialExpired: boolean;
  trialDaysTotal: number;
  trialDaysRemaining: number;
  trialEndsAt?: string;
  email?: string;
  name?: string;
  serialMasked?: string;
  /** True while status is still loading from native host. */
  statusPending?: boolean;
  /** Bound via Cloudflare activation API. */
  onlineBound?: boolean;
  licenseMode?: string;
}

/** Optimistic shell defaults while waiting for native status (not a grant). */
export const PENDING_LICENSE_STATUS: LicenseStatus = {
  activated: false,
  canUseApp: true,
  trialExpired: false,
  trialDaysTotal: 14,
  trialDaysRemaining: 14,
  statusPending: true,
};

/**
 * Fail-closed fallback for native IPC errors after retries.
 * Browser preview should not use this for day-to-day Vite work.
 */
export const DENIED_LICENSE_STATUS: LicenseStatus = {
  activated: false,
  canUseApp: false,
  trialExpired: true,
  trialDaysTotal: 14,
  trialDaysRemaining: 0,
  statusPending: false,
};

/** @deprecated Prefer PENDING_LICENSE_STATUS or DENIED_LICENSE_STATUS explicitly. */
export const EMPTY_LICENSE_STATUS = PENDING_LICENSE_STATUS;
