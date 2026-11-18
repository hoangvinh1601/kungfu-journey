export function timeAgo(iso){
  const s = (Date.now() - new Date(iso).getTime())/1000;
  if(s < 60) return 'vừa xong';
  if(s < 3600) return Math.floor(s/60) + ' phút';
  if(s < 86400) return Math.floor(s/3600) + ' giờ';
  if(s < 604800) return Math.floor(s/86400) + ' ngày';
  return new Date(iso).toLocaleDateString('vi-VN');
}
export const initials = name => (name || '?').trim().split(/\s+/).slice(-2).map(w => w[0]).join('').toUpperCase();
