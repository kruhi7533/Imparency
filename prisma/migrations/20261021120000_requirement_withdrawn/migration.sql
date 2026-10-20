-- The donor may withdraw a CSR requirement before a proposal is selected (terminal).
ALTER TYPE "RequirementStatus" ADD VALUE IF NOT EXISTS 'WITHDRAWN';
