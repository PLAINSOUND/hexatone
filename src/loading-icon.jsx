import LoadingIconSvg from "./img/hex.svg?react";

export default function LoadingIcon(props) {
  const className = props.className ? `app-loading-icon ${props.className}` : "app-loading-icon";
  return <LoadingIconSvg {...props} className={className} />;
}
