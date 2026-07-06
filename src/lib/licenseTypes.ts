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
}

export const EMPTY_LICENSE_STATUS: LicenseStatus = {
  activated: false,
  canUseApp: true,
  trialExpired: false,
  trialDaysTotal: 14,
  trialDaysRemaining: 14,
};
