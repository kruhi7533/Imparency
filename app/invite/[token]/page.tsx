import InviteAcceptClient from "./InviteAcceptClient";

export const dynamic = "force-dynamic";

/** NGO-003: accept an NGO team invitation. The token is checked server-side by POST /api/team-invites/*. */
export default function InvitePage({ params }: { params: { token: string } }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-16 px-4">
      <InviteAcceptClient token={params.token} />
    </div>
  );
}
