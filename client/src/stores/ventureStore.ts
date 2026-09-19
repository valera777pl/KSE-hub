import { create } from 'zustand';
import type { SwipeCardProfile, SwipeCardProject, MatchResult, VentureProfile } from '../types';
import { api } from '../api/client';

interface VentureState {
  deck: (SwipeCardProfile | SwipeCardProject)[];
  deckType: 'profile' | 'project';
  myProfile: VentureProfile | null;
  matchResult: MatchResult | null;
  loading: boolean;
  error: string | null;
  setDeckType: (type: 'profile' | 'project') => void;
  fetchDeck: () => Promise<void>;
  fetchMyProfile: () => Promise<void>;
  swipe: (targetId: number, targetType: 'profile' | 'project', isLike: boolean) => Promise<MatchResult>;
  clearMatch: () => void;
}

export const useVentureStore = create<VentureState>((set, get) => ({
  deck: [],
  deckType: 'profile',
  myProfile: null,
  matchResult: null,
  loading: false,
  error: null,

  setDeckType: (type) => {
    set({ deckType: type });
    get().fetchDeck();
  },

  fetchDeck: async () => {
    try {
      set({ loading: true });
      const { cards } = await api.get<{ cards: any[] }>(`/venture/deck?type=${get().deckType}`);
      set({ deck: cards, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  fetchMyProfile: async () => {
    try {
      const { profile } = await api.get<{ profile: VentureProfile | null }>('/venture/profile');
      set({ myProfile: profile });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  swipe: async (targetId, targetType, isLike) => {
    const result = await api.post<MatchResult>('/venture/swipe', {
      targetId,
      targetType,
      isLike,
    });

    if (result.matched) {
      set({ matchResult: result });
    }

    // Remove swiped card from deck
    set((state) => ({
      deck: state.deck.slice(1),
    }));

    return result;
  },

  clearMatch: () => set({ matchResult: null }),
}));
