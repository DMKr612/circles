import { getAvatarUrl } from "@/lib/avatar";

type AvatarImageProps = {
  avatarUrl?: string | null;
  seed?: string | null;
  alt: string;
  className?: string;
  size?: number;
};

export default function AvatarImage({ avatarUrl, seed, alt, className, size }: AvatarImageProps) {
  return <img src={getAvatarUrl(avatarUrl, seed, size)} alt={alt} className={className} />;
}

