import { Redirect, Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, FontFamily } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';

type AuthGateState = 'pending' | 'signed-out' | 'unverified' | 'signed-in';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const [authState, setAuthState] = useState<AuthGateState>('pending');

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setAuthState(!user ? 'signed-out' : user.emailVerified ? 'signed-in' : 'unverified');
    });

    return unsubscribe;
  }, []);

  // Hold rendering until Firebase resolves the persisted session so
  // signed-in users don't flash through the welcome screen on cold start.
  if (authState === 'pending') {
    return null;
  }

  if (authState === 'signed-out') {
    return <Redirect href="/welcome" />;
  }

  if (authState === 'unverified') {
    return <Redirect href="/verify-email" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.tint,
        tabBarInactiveTintColor: palette.tabIconDefault,
        headerShown: false,
        tabBarButton: HapticTab,
        // Board TabBar sits on the cream canvas (bg-background/95), not card white.
        tabBarStyle: {
          backgroundColor: palette.background,
          borderTopColor: palette.border,
        },
        tabBarLabelStyle: {
          fontFamily: FontFamily.bodySemiBold,
          fontSize: 11,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="message.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'You',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="person.crop.circle.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Spots',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="paperplane.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
