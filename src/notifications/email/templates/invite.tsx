import { Text } from '@react-email/components';
import { Layout, code, heading, paragraph } from './_layout.js';

export interface InviteProps {
  readonly role: string;
  readonly inviteCode: string;
  readonly expiresAt: string;
}

/**
 * `user.invited`. The code is the whole authorisation for a public route, which
 * is why it travels here and nowhere else - not in a log, not on a socket, and
 * not in the admin notification that says an address was invited.
 */
const Invite = ({ role, inviteCode, expiresAt }: InviteProps) => (
  <Layout preview="You have been invited">
    <Text style={heading}>You have been invited</Text>
    <Text style={paragraph}>
      An administrator invited you to join as <strong>{role}</strong>. Redeem
      this code to choose a password and create your account.
    </Text>
    <Text style={code}>{inviteCode}</Text>
    <Text style={paragraph}>
      It expires on {new Date(expiresAt).toUTCString()}.
    </Text>
  </Layout>
);

Invite.PreviewProps = {
  role: 'admin',
  inviteCode: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
} satisfies InviteProps;

export default Invite;
