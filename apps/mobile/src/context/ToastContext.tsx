import React, { createContext, useContext, useState, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Platform, StatusBar, TouchableOpacity } from 'react-native';
import { Info, CheckCircle2, AlertCircle, AlertTriangle, X } from 'lucide-react-native';

export type ToastType = 'info' | 'success' | 'error' | 'warning';

interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<ToastOptions | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, type: ToastType = 'info', duration: number = 3500) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    setToast({ message, type, duration });

    fadeAnim.setValue(0);
    slideAnim.setValue(-80);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        tension: 50,
        useNativeDriver: true,
      }),
    ]).start();

    timerRef.current = setTimeout(() => {
      hideToast();
    }, duration);
  };

  const hideToast = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -80,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToast(null);
    });
  };

  const getToastBg = () => {
    switch (toast?.type) {
      case 'success':
        return '#059669'; // Emerald Green
      case 'error':
        return '#DC2626'; // Bright Red
      case 'warning':
        return '#D97706'; // Amber Gold
      case 'info':
      default:
        return '#4F46E5'; // Indigo Accent
    }
  };

  const renderIcon = () => {
    switch (toast?.type) {
      case 'success':
        return <CheckCircle2 size={20} color="#FFF" />;
      case 'error':
        return <AlertCircle size={20} color="#FFF" />;
      case 'warning':
        return <AlertTriangle size={20} color="#FFF" />;
      case 'info':
      default:
        return <Info size={20} color="#FFF" />;
    }
  };

  const statusBarPadding = Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 10 : 50;

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {toast && (
        <Animated.View
          style={[
            styles.toastContainer,
            {
              top: statusBarPadding,
              backgroundColor: getToastBg(),
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.toastContent}>
            <View style={styles.iconWrapper}>{renderIcon()}</View>
            <Text style={styles.toastText}>{toast.message}</Text>
            <TouchableOpacity onPress={hideToast} style={styles.closeBtn} activeOpacity={0.7}>
              <X size={16} color="#FFF" />
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 99999,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
    maxWidth: 520,
    alignSelf: 'center',
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconWrapper: {
    marginRight: 12,
  },
  toastText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  closeBtn: {
    padding: 4,
    marginLeft: 10,
  },
});
