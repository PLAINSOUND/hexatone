/**
 * src/loading-icon.jsx
 *
 * Thin wrapper around the shared loading SVG so the app can consistently apply
 * its loading-icon class while still accepting extra className/style props.
 */
import LoadingIconSvg from "./img/hex.svg?react";

export default function LoadingIcon(props) {
  const className = props.className ? `app-loading-icon ${props.className}` : "app-loading-icon";
  return <LoadingIconSvg {...props} className={className} />;
}
