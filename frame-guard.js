if (window.top !== window.self) {
  document.documentElement.textContent = "";
  try {
    window.top.location.replace(window.location.href);
  } catch {
    // La page reste vide dans une iframe étrangère pour éviter le clickjacking.
  }
}
