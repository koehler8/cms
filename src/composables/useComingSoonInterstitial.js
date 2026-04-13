import { ref } from 'vue';

const isVisible = ref(false);
const modalTitle = ref('Coming Soon');
const modalMessage = ref("We're putting the finishing touches on this experience. Check back soon!");

export function useComingSoonInterstitial() {
  const openComingSoon = ({ title, message } = {}) => {
    modalTitle.value = title || 'Coming Soon';
    modalMessage.value =
      message ||
      "We're putting the finishing touches on this experience. Check back soon!";
    isVisible.value = true;
  };

  const closeComingSoon = () => {
    isVisible.value = false;
  };

  return {
    isComingSoonVisible: isVisible,
    comingSoonTitle: modalTitle,
    comingSoonMessage: modalMessage,
    openComingSoon,
    closeComingSoon,
  };
}
