import { Button, Text } from '@react-email/components';
import { Layout, button, heading, paragraph } from './_layout.js';

export interface WelcomeProps {
  readonly name: string;
  readonly signInUrl: string;
}

/**
 * `user.registered`, sent by the worker after better-auth creates a user.
 */
const Welcome = ({ name, signInUrl }: WelcomeProps) => (
  <Layout preview={`Welcome, ${name}`}>
    <Text style={heading}>Welcome, {name}</Text>
    <Text style={paragraph}>
      Your account is ready. Everything the API exposes is documented, and your
      session is the same one the explorer signs in with.
    </Text>
    <Button href={signInUrl} style={button}>
      Sign in
    </Button>
  </Layout>
);

/**
 * What `dunx-email preview` renders this with. React Email's own convention, and
 * `ReactEmailRenderer.previewProps` is what reads it - so a renderer with a
 * different convention answers for its own templates.
 */
Welcome.PreviewProps = {
  name: 'Ada Lovelace',
  signInUrl: 'http://localhost:3001/api/docs',
} satisfies WelcomeProps;

export default Welcome;
