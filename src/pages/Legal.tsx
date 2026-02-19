import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function Legal() {
  const navigate = useNavigate();

  function goBack() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/");
  }

  return (
    <div className="min-h-screen bg-white p-6 max-w-2xl mx-auto">
      <button
        type="button"
        onClick={goBack}
        className="inline-flex items-center gap-2 text-neutral-600 mb-6 hover:text-black"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      
      <h1 className="text-3xl font-bold mb-6">Legal & Privacy</h1>
      
      <section className="mb-8 space-y-4">
        <h2 className="text-xl font-bold">Privacy Policy</h2>
        <p className="text-neutral-600 text-sm">
          We respect your privacy. We only store the data necessary for the app to function (your profile, messages, and groups). 
          We do not sell your data. You can delete your account and data at any time by contacting support.
        </p>
      </section>

      <section className="mb-8 space-y-4">
        <h2 className="text-xl font-bold">Terms of Service</h2>
        <p className="text-neutral-600 text-sm">
          By using Circles, you agree to be kind and respectful. We have zero tolerance for harassment, hate speech, or objectional content.
          Users posting such content will be banned. You are responsible for your own interactions.
        </p>
      </section>
      
      <section className="mb-8 space-y-4">
        <h2 className="text-xl font-bold">Contact</h2>
        <p className="text-neutral-600 text-sm">
          Questions? Email us at support@meincircles.com
        </p>
      </section>
    </div>
  );
}
