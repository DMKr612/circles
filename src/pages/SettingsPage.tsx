import SettingsModal from "@/components/SettingsModal";
import { useNavigate } from "react-router-dom";

export default function SettingsPage() {
  const navigate = useNavigate();

  return (
    <SettingsModal
      isOpen={true}
      variant="page"
      onClose={() => navigate("/profile")}
      onSave={() => {}}
    />
  );
}

