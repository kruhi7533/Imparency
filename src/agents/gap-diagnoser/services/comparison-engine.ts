import { Project, NGOCompliance, Milestone } from '@prisma/client';
import { 
  SponsorRequirementData, 
  ComparisonResult, 
  DimensionComparison 
} from '../types/gap-types';

export class ComparisonEngine {
  public compare(
    sponsorRequirementId: string, 
    requirement: SponsorRequirementData, 
    activeProjects: (Project & { milestones: Milestone[] })[], 
    ngoCompliance: NGOCompliance | null
  ): ComparisonResult {
    const dimensions: DimensionComparison[] = [];

    // Helper to log empty initiative status
    const hasProjects = activeProjects.length > 0;

    // 1. Sector (Cause Category)
    if (requirement.sector) {
      let status: 'MATCH' | 'PARTIAL' | 'MISSING' = 'MISSING';
      const reqSectorLower = requirement.sector.toLowerCase();
      
      const exactMatch = activeProjects.some(p => p.causeCategory.toLowerCase() === reqSectorLower);
      const substringMatch = activeProjects.some(p => p.causeCategory.toLowerCase().includes(reqSectorLower) || reqSectorLower.includes(p.causeCategory.toLowerCase()));
      
      if (exactMatch) {
        status = 'MATCH';
      } else if (substringMatch) {
        status = 'PARTIAL';
      }
      
      dimensions.push({
        dimension: 'Sector',
        status,
        sponsorValue: requirement.sector,
        ngoValue: hasProjects ? Array.from(new Set(activeProjects.map(p => p.causeCategory))).join(', ') : 'No active projects',
        notes: 'Sector compatibility'
      });
    }

    // 2. Geography - State
    if (requirement.state) {
      let status: 'MATCH' | 'PARTIAL' | 'MISSING' = 'MISSING';
      const reqStateLower = requirement.state.toLowerCase();
      
      const hasStateMatch = activeProjects.some(p => 
        (p.stateName && p.stateName.toLowerCase() === reqStateLower) ||
        (p.location && p.location.toLowerCase().includes(reqStateLower))
      );

      if (hasStateMatch) {
        status = 'MATCH';
      }

      dimensions.push({
        dimension: 'Geography',
        status,
        sponsorValue: requirement.state,
        ngoValue: hasProjects ? Array.from(new Set(activeProjects.map(p => p.stateName || p.location))).filter(Boolean).join(', ') : 'No active locations',
        notes: 'State level comparison'
      });
    }

    // 3. Geography - District
    if (requirement.district) {
      let status: 'MATCH' | 'PARTIAL' | 'MISSING' = 'MISSING';
      const reqDistrictLower = requirement.district.toLowerCase();
      
      const hasDistrictMatch = activeProjects.some(p => 
        (p.districtName && p.districtName.toLowerCase() === reqDistrictLower) ||
        (p.location && p.location.toLowerCase().includes(reqDistrictLower))
      );

      if (hasDistrictMatch) {
        status = 'MATCH';
      } else if (requirement.state) {
        // Partial if state matches but district doesn't
        const reqStateLower = requirement.state.toLowerCase();
        const hasStateMatch = activeProjects.some(p => 
          (p.stateName && p.stateName.toLowerCase() === reqStateLower) ||
          (p.location && p.location.toLowerCase().includes(reqStateLower))
        );
        if (hasStateMatch) {
          status = 'PARTIAL';
        }
      }

      dimensions.push({
        dimension: 'Geography',
        status,
        sponsorValue: requirement.district,
        ngoValue: hasProjects ? Array.from(new Set(activeProjects.map(p => p.districtName || p.location))).filter(Boolean).join(', ') : 'No active districts',
        notes: 'District level comparison'
      });
    }

    // 4. Budget
    if (requirement.budget && requirement.budget > 0) {
      let status: 'MATCH' | 'PARTIAL' | 'MISSING' = 'MISSING';
      const maxNgoBudget = activeProjects.reduce((max, p) => Math.max(max, Number(p.targetAmount)), 0);
      
      if (maxNgoBudget >= requirement.budget) {
        status = 'MATCH';
      } else if (maxNgoBudget >= requirement.budget * 0.5) {
        status = 'PARTIAL';
      }

      dimensions.push({
        dimension: 'Budget',
        status,
        sponsorValue: requirement.budget,
        ngoValue: maxNgoBudget,
        notes: `Largest initiative budget: ₹${maxNgoBudget.toLocaleString('en-IN')}`
      });
    }

    // 5. Timeline (Duration in Months)
    if (requirement.durationMonths && requirement.durationMonths > 0) {
      let status: 'MATCH' | 'PARTIAL' | 'MISSING' = 'MISSING';
      let maxDuration = 0;

      activeProjects.forEach(p => {
        if (p.milestones && p.milestones.length > 0) {
          const deadlines = p.milestones.map(m => new Date(m.deadline).getTime());
          const minTime = new Date(p.createdAt).getTime();
          const maxTime = Math.max(...deadlines);
          const diffMs = maxTime - minTime;
          const diffMonths = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24 * 30.4375)));
          if (diffMonths > maxDuration) {
            maxDuration = diffMonths;
          }
        } else {
          // Default baseline project length
          if (12 > maxDuration) {
            maxDuration = 12;
          }
        }
      });

      if (maxDuration >= requirement.durationMonths * 0.8 && maxDuration <= requirement.durationMonths * 1.5) {
        status = 'MATCH';
      } else if (maxDuration >= requirement.durationMonths * 0.5) {
        status = 'PARTIAL';
      }

      dimensions.push({
        dimension: 'Timeline',
        status,
        sponsorValue: `${requirement.durationMonths} months`,
        ngoValue: hasProjects ? `${maxDuration} months` : 'N/A',
        notes: 'Initiative execution timeline suitability'
      });
    }

    // 6. Target Beneficiaries
    if (requirement.beneficiaries && requirement.beneficiaries > 0) {
      let status: 'MATCH' | 'PARTIAL' | 'MISSING' = 'MISSING';
      let totalBeneficiaries = 0;

      // Extract beneficiaries from outcomes and description using regex
      const bRegex = /(\d{1,3}(?:,\d{3})+|\d+)\s*(?:direct\s*)?(?:beneficiar|people|student|children|child|famil|farmer|women|villager|individual)/i;
      
      activeProjects.forEach(p => {
        const text = `${p.description || ''} ${p.problem_statement || ''} ${p.expected_outcome || ''}`;
        const match = text.match(bRegex);
        if (match) {
          const num = parseInt(match[1].replace(/,/g, ''), 10);
          totalBeneficiaries = Math.max(totalBeneficiaries, num);
        }
      });

      if (totalBeneficiaries >= requirement.beneficiaries) {
        status = 'MATCH';
      } else if (totalBeneficiaries >= requirement.beneficiaries * 0.5) {
        status = 'PARTIAL';
      }

      dimensions.push({
        dimension: 'Other',
        status,
        sponsorValue: requirement.beneficiaries,
        ngoValue: totalBeneficiaries || 'Not specified in active project details',
        notes: 'Target Beneficiaries comparison'
      });
    }

    // 7. KPIs
    if (requirement.kpis && requirement.kpis.length > 0) {
      let status: 'MATCH' | 'PARTIAL' | 'MISSING' = 'MISSING';
      const matchedKpis: string[] = [];

      activeProjects.forEach(p => {
        const text = `${p.description || ''} ${p.problem_statement || ''} ${p.expected_outcome || ''}`.toLowerCase();
        requirement.kpis!.forEach(kpi => {
          if (text.includes(kpi.toLowerCase()) && !matchedKpis.includes(kpi)) {
            matchedKpis.push(kpi);
          } else {
            // Check individual words
            const words = kpi.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            if (words.length > 0 && words.every(w => text.includes(w)) && !matchedKpis.includes(kpi)) {
              matchedKpis.push(kpi);
            }
          }
        });
      });

      if (matchedKpis.length === requirement.kpis.length) {
        status = 'MATCH';
      } else if (matchedKpis.length > 0) {
        status = 'PARTIAL';
      }

      dimensions.push({
        dimension: 'KPIs',
        status,
        sponsorValue: requirement.kpis.join(', '),
        ngoValue: matchedKpis.length > 0 ? matchedKpis.join(', ') : 'None matched',
        notes: `Matched ${matchedKpis.length} of ${requirement.kpis.length} KPIs`
      });
    }

    // 8. Reporting Cadence
    if (requirement.reportingCadence) {
      let status: 'MATCH' | 'PARTIAL' | 'MISSING' = 'MISSING';
      let detectedCadence = 'Annual';

      // Estimate reporting cadence based on milestones count/spacing
      activeProjects.forEach(p => {
        if (p.milestones && p.milestones.length > 1) {
          const deadlines = p.milestones.map(m => new Date(m.deadline).getTime()).sort((a, b) => a - b);
          let totalDiff = 0;
          for (let i = 1; i < deadlines.length; i++) {
            totalDiff += (deadlines[i] - deadlines[i - 1]);
          }
          const avgDays = (totalDiff / (deadlines.length - 1)) / (1000 * 60 * 60 * 24);
          
          if (avgDays <= 45) detectedCadence = 'Monthly';
          else if (avgDays <= 110) detectedCadence = 'Quarterly';
          else if (avgDays <= 200) detectedCadence = 'Bi-annual';
        }
      });

      const cadenceRanks: Record<string, number> = {
        'Monthly': 4,
        'Quarterly': 3,
        'Bi-annual': 2,
        'Annual': 1
      };

      const reqRank = cadenceRanks[requirement.reportingCadence] || 1;
      const ngoRank = cadenceRanks[detectedCadence] || 1;

      if (ngoRank >= reqRank) {
        status = 'MATCH';
      } else if (ngoRank === reqRank - 1) {
        status = 'PARTIAL';
      }

      dimensions.push({
        dimension: 'KPIs',
        status,
        sponsorValue: requirement.reportingCadence,
        ngoValue: detectedCadence,
        notes: `Estimated reporting interval: ${detectedCadence}`
      });
    }

    // 9. Required Certifications
    if (requirement.requiredCertifications && requirement.requiredCertifications.length > 0) {
      let status: 'MATCH' | 'PARTIAL' | 'MISSING' = 'MISSING';
      const availableCerts: string[] = [];

      if (ngoCompliance) {
        if (ngoCompliance.a12Verified) availableCerts.push('12A');
        if (ngoCompliance.eightyGVerified) availableCerts.push('80G');
        if (ngoCompliance.panVerified) availableCerts.push('PAN');
        if (ngoCompliance.registrationVerified) availableCerts.push('REGISTRATION');
      }

      const matchedCerts = requirement.requiredCertifications.filter(cert => 
        availableCerts.some(c => c.toLowerCase().includes(cert.toLowerCase()) || cert.toLowerCase().includes(c.toLowerCase()))
      );

      if (matchedCerts.length === requirement.requiredCertifications.length) {
        status = 'MATCH';
      } else if (matchedCerts.length > 0) {
        status = 'PARTIAL';
      }

      dimensions.push({
        dimension: 'Compliance',
        status,
        sponsorValue: requirement.requiredCertifications.join(', '),
        ngoValue: availableCerts.join(', ') || 'No verified compliance certifications',
        notes: 'Required certifications audit'
      });
    }

    // 10. FCRA Requirement
    if (requirement.fcraRequired !== undefined) {
      let status: 'MATCH' | 'PARTIAL' | 'MISSING' = 'MISSING';
      const fcraStatus = ngoCompliance?.fcraStatus || 'NONE';

      if (!requirement.fcraRequired) {
        status = 'MATCH'; // Not required, so always matches
      } else {
        if (fcraStatus === 'ACTIVE') {
          status = 'MATCH';
        } else if (fcraStatus === 'EXPIRING_SOON') {
          status = 'PARTIAL';
        }
      }

      dimensions.push({
        dimension: 'Compliance',
        status,
        sponsorValue: requirement.fcraRequired ? 'Required (Active)' : 'Not Required',
        ngoValue: `FCRA Status: ${fcraStatus}`,
        notes: 'FCRA compliance validation'
      });
    }

    // 11. Special Constraints
    if (requirement.specialConstraints && requirement.specialConstraints.length > 0) {
      let status: 'MATCH' | 'PARTIAL' | 'MISSING' = 'MISSING';
      const matchedConstraints: string[] = [];

      activeProjects.forEach(p => {
        const text = `${p.description || ''} ${p.problem_statement || ''} ${p.expected_outcome || ''}`.toLowerCase();
        requirement.specialConstraints!.forEach(sc => {
          if (text.includes(sc.toLowerCase()) && !matchedConstraints.includes(sc)) {
            matchedConstraints.push(sc);
          }
        });
      });

      if (matchedConstraints.length === requirement.specialConstraints.length) {
        status = 'MATCH';
      } else if (matchedConstraints.length > 0) {
        status = 'PARTIAL';
      }

      dimensions.push({
        dimension: 'Other',
        status,
        sponsorValue: requirement.specialConstraints.join(', '),
        ngoValue: matchedConstraints.length > 0 ? matchedConstraints.join(', ') : 'None verified',
        notes: 'Special constraints checks'
      });
    }

    // 12. SDG Goals
    if (requirement.sdgGoals && requirement.sdgGoals.length > 0) {
      let status: 'MATCH' | 'PARTIAL' | 'MISSING' = 'MISSING';
      const matchedSDGs: string[] = [];

      activeProjects.forEach(p => {
        const text = `${p.description || ''} ${p.problem_statement || ''} ${p.expected_outcome || ''} ${p.causeCategory || ''}`.toLowerCase();
        requirement.sdgGoals!.forEach(sdg => {
          if (text.includes(sdg.toLowerCase()) && !matchedSDGs.includes(sdg)) {
            matchedSDGs.push(sdg);
          }
        });
      });

      if (matchedSDGs.length === requirement.sdgGoals.length) {
        status = 'MATCH';
      } else if (matchedSDGs.length > 0) {
        status = 'PARTIAL';
      }

      dimensions.push({
        dimension: 'Other',
        status,
        sponsorValue: requirement.sdgGoals.join(', '),
        ngoValue: matchedSDGs.length > 0 ? matchedSDGs.join(', ') : 'None matched',
        notes: 'SDG Goals alignment'
      });
    }

    return {
      sponsorRequirementId,
      dimensions,
      activeProjectsCount: activeProjects.length
    };
  }
}
