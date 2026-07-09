import axios from 'axios';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const baseURL =
  (Constants.expoConfig?.extra as any)?.apiBaseUrl ??
  'http://localhost:4000/api/v1';

export const api = axios.create({ baseURL });

api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('itamls_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    if (err.response?.status === 401) {
      await AsyncStorage.removeItem('itamls_token');
      await AsyncStorage.removeItem('itamls_user');
    }
    return Promise.reject(err);
  },
);
