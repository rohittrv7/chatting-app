import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Text } from 'react-native';

interface TypingDotsProps {
  color?: string;
  dotSize?: number;
}

export const TypingDots: React.FC<TypingDotsProps> = ({ color = '#10B981', dotSize = 5 }) => {
  const dot1Anim = useRef(new Animated.Value(0)).current;
  const dot2Anim = useRef(new Animated.Value(0)).current;
  const dot3Anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createBounceAnim = (anim: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: -5,
            duration: 260,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0,
            duration: 260,
            useNativeDriver: true,
          }),
          Animated.delay(500 - delay),
        ]),
      );
    };

    const anim1 = createBounceAnim(dot1Anim, 0);
    const anim2 = createBounceAnim(dot2Anim, 140);
    const anim3 = createBounceAnim(dot3Anim, 280);

    anim1.start();
    anim2.start();
    anim3.start();

    return () => {
      anim1.stop();
      anim2.stop();
      anim3.stop();
    };
  }, [dot1Anim, dot2Anim, dot3Anim]);

  return (
    <View style={styles.dotsContainer}>
      <Animated.View
        style={[
          styles.dot,
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: color,
            transform: [{ translateY: dot1Anim }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.dot,
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: color,
            transform: [{ translateY: dot2Anim }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.dot,
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: color,
            transform: [{ translateY: dot3Anim }],
          },
        ]}
      />
    </View>
  );
};

interface TypingBubbleProps {
  displayName?: string;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  dotColor?: string;
}

export const TypingBubble: React.FC<TypingBubbleProps> = ({
  backgroundColor = '#1E293B',
  borderColor = 'transparent',
  dotColor = '#94A3B8',
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  return (
    <Animated.View style={[styles.bubbleWrapper, { opacity: fadeAnim }]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor,
            borderColor,
          },
        ]}
      >
        <TypingDots color={dotColor} dotSize={6} />
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 2,
    height: 14,
  },
  dot: {
    marginHorizontal: 1,
  },
  bubbleWrapper: {
    marginVertical: 4,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    minWidth: 54,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  nameText: {
    fontSize: 12,
    fontWeight: '700',
    marginRight: 8,
  },
});
