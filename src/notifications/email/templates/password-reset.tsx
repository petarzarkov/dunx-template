import { Button, Text } from '@react-email/components';
import { Layout, button, heading, paragraph } from './_layout.js';

export interface PasswordResetProps {
  readonly url: string;
}

/**
 * `user.password_reset`. better-auth mints the link and owns its expiry; this
 * only delivers it.
 */
const PasswordReset = ({ url }: PasswordResetProps) => (
  <Layout preview="Reset your password">
    <Text style={heading}>Reset your password</Text>
    <Text style={paragraph}>
      Follow this link to choose a new one. If you did not ask for this, nothing
      has changed and you can ignore this message.
    </Text>
    <Button href={url} style={button}>
      Choose a new password
    </Button>
  </Layout>
);

PasswordReset.PreviewProps = {
  url: 'http://localhost:3001/api/auth/reset-password?token=preview',
} satisfies PasswordResetProps;

export default PasswordReset;
