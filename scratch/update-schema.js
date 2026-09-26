const fs = require('fs');
let schema = fs.readFileSync('prisma/schema.prisma', 'utf8');

const proposalSchema = `
enum ProposalStatus {
  DRAFT
  SUBMITTED
  CHANGE_REQUESTED
  APPROVED
  REJECTED
}

model Proposal {
  id                   String             @id @default(uuid())
  sponsorRequirementId String
  sponsorRequirement   SponsorRequirement @relation(fields: [sponsorRequirementId], references: [id], onDelete: Cascade)
  ngoId                String
  ngo                  NGOProfile         @relation(fields: [ngoId], references: [id], onDelete: Cascade)
  activities           String
  budget               Float
  milestones           Json
  version              Int                @default(1)
  status               ProposalStatus     @default(DRAFT)
  feedback             String?
  history              Json               @default("[]")
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt

  @@index([sponsorRequirementId])
  @@index([ngoId])
}
`;

if (!schema.includes('ProposalStatus')) {
  schema += proposalSchema;
  
  if (schema.includes('model SponsorRequirement {')) {
    schema = schema.replace(/model SponsorRequirement \{([\s\S]*?)\}/, 'model SponsorRequirement {$1  proposals Proposal[]\n}');
  }
  
  if (schema.includes('model NGOProfile {')) {
    schema = schema.replace(/model NGOProfile \{([\s\S]*?)\}/, 'model NGOProfile {$1  proposals Proposal[]\n}');
  }
  
  fs.writeFileSync('prisma/schema.prisma', schema);
  console.log("Appended Proposal to schema");
} else {
  console.log("Proposal already exists in schema");
}
