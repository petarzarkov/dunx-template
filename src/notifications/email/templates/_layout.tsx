import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';

/**
 * The shell every template renders inside.
 *
 * Underscore-prefixed so `discoverTemplates` skips it: this is not a renderable
 * template and listing it in the preview sidebar would offer a page that throws.
 *
 * Styles are inline objects rather than a stylesheet, because that is the only
 * thing every mail client agrees on.
 */
export const Layout = ({
  preview,
  children,
}: {
  readonly preview: string;
  readonly children: ReactNode;
}) => (
  <Html lang="en">
    <Head />
    <Preview>{preview}</Preview>
    <Body style={body}>
      <Container style={container}>
        <Section>{children}</Section>
        <Hr style={rule} />
        <Text style={footer}>
          Sent by dunx-template. You are receiving this because an account was
          created with this address.
        </Text>
      </Container>
    </Body>
  </Html>
);

const body = {
  backgroundColor: '#f1f5f9',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  margin: 0,
  padding: '24px 0',
};

const container = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
  margin: '0 auto',
  maxWidth: '520px',
  padding: '32px',
};

const rule = { borderColor: '#e2e8f0', margin: '28px 0 16px' };

const footer = { color: '#64748b', fontSize: '12px', lineHeight: '18px' };

export const heading = {
  color: '#0f172a',
  fontSize: '20px',
  fontWeight: 600,
  margin: '0 0 12px',
};

export const paragraph = {
  color: '#334155',
  fontSize: '14px',
  lineHeight: '22px',
  margin: '0 0 16px',
};

export const button = {
  backgroundColor: '#2563eb',
  borderRadius: '8px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '14px',
  fontWeight: 600,
  padding: '10px 18px',
  textDecoration: 'none',
};

export const code = {
  backgroundColor: '#0f172a',
  borderRadius: '8px',
  color: '#e2e8f0',
  display: 'block',
  fontFamily: 'ui-monospace, monospace',
  fontSize: '15px',
  letterSpacing: '0.08em',
  padding: '14px 18px',
  wordBreak: 'break-all' as const,
};
