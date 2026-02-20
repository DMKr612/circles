import { useLocation, useNavigate, useParams } from "react-router-dom";
import ViewOtherProfileModal from "@/components/ViewOtherProfileModal";

export default function UserProfileView() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from;

  const goBack = () => {
    if (typeof from === "string" && from.trim()) {
      navigate(from);
      return;
    }
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/profile");
  };

  return (
    <ViewOtherProfileModal
      mode="page"
      onClose={goBack}
      viewUserId={userId ?? null}
    />
  );
}
