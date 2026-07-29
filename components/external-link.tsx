import { Href, Link } from 'expo-router';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { type ComponentProps } from 'react';
import { Alert, Linking } from 'react-native';

import { handleExternalLinkPress } from '@/lib/external-link-press';

type Props = Omit<ComponentProps<typeof Link>, 'href'> & { href: Href & string };

export function ExternalLink({ href, ...rest }: Props) {
  return (
    <Link
      target="_blank"
      {...rest}
      href={href}
      onPress={(event) => {
        // Pressable drops whatever this returns, so nothing may reject.
        // handleExternalLinkPress already resolves on every path; the .catch()
        // is the last line of defense. Branching, preventDefault, and the
        // fallback alerts all live in lib/external-link-press.js.
        void handleExternalLinkPress({
          href,
          isWeb: process.env.EXPO_OS === 'web',
          preventDefault: () => event.preventDefault(),
          canOpenURL: (url) => Linking.canOpenURL(url),
          openURL: (url) => Linking.openURL(url),
          openBrowser: (url) =>
            openBrowserAsync(url, {
              presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
            }),
          alert: (title, message) => Alert.alert(title, message),
        }).catch(() => {});
      }}
    />
  );
}
